//! Linux process auxiliary-vector compatibility for the explicit legacy webOS build.
//! Uses the native-word pairs documented by proc_pid_auxv(5). No heap allocation,
//! cached state, or Rust runtime initialization is needed during executable startup.
const WORD: usize = core::mem::size_of::<usize>();
const PAIR: usize = 2 * WORD;
const MAX_PAIRS: usize = 4096;

trait ProcessAuxv {
    fn open(&mut self) -> Result<i32, i32>;
    fn read(&mut self, fd: i32, buffer: &mut [u8]) -> Result<usize, i32>;
    fn close(&mut self, fd: i32) -> Result<(), i32>;
}

fn scan(mut read: impl FnMut(&mut [u8]) -> Result<usize, i32>, kind: usize) -> Result<usize, i32> {
    for _ in 0..MAX_PAIRS {
        let mut pair = [0u8; PAIR];
        let mut received = 0;
        while received < PAIR {
            match read(&mut pair[received..]) {
                Err(libc::EINTR) => continue,
                Err(error) => return Err(error),
                Ok(0) => return Err(libc::EIO),
                Ok(count) if count <= PAIR - received => received += count,
                Ok(_) => return Err(libc::EIO),
            }
        }
        let mut tag = [0u8; WORD];
        let mut value = [0u8; WORD];
        tag.copy_from_slice(&pair[..WORD]);
        value.copy_from_slice(&pair[WORD..]);
        let tag = usize::from_ne_bytes(tag);
        if tag == 0 {
            return Err(libc::ENOENT);
        }
        if tag == kind {
            return Ok(usize::from_ne_bytes(value));
        }
    }
    Err(libc::E2BIG)
}

fn query(source: &mut impl ProcessAuxv, kind: usize) -> Result<usize, i32> {
    if kind == 0 {
        return Err(libc::ENOENT);
    }
    let fd = loop {
        match source.open() {
            Err(libc::EINTR) => continue,
            result => break result?,
        }
    };
    let result = scan(|buffer| source.read(fd, buffer), kind);
    // Linux consumes the descriptor even when close returns EINTR. Never retry
    // and risk closing a descriptor another thread has acquired in the meantime.
    let closed = source.close(fd);
    match result {
        Ok(value) => closed.map(|()| value),
        Err(error) => Err(error),
    }
}

#[cfg(all(
    feature = "webos-legacy-glibc",
    target_arch = "arm",
    target_os = "linux"
))]
mod linux {
    use super::*;

    struct CurrentProcess;

    fn errno() -> i32 {
        // Linux libc keeps errno in thread-local storage, including before main.
        unsafe { *libc::__errno_location() }
    }

    impl ProcessAuxv for CurrentProcess {
        fn open(&mut self) -> Result<i32, i32> {
            let fd = unsafe {
                libc::open(
                    c"/proc/self/auxv".as_ptr(),
                    libc::O_RDONLY | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                Err(errno())
            } else {
                Ok(fd)
            }
        }

        fn read(&mut self, fd: i32, buffer: &mut [u8]) -> Result<usize, i32> {
            let count = unsafe { libc::read(fd, buffer.as_mut_ptr().cast(), buffer.len()) };
            if count < 0 {
                Err(errno())
            } else {
                Ok(count as usize)
            }
        }

        fn close(&mut self, fd: i32) -> Result<(), i32> {
            if unsafe { libc::close(fd) } < 0 {
                Err(errno())
            } else {
                Ok(())
            }
        }
    }

    /// Only the explicitly opted-in legacy ARM executable defines this symbol.
    /// General Linux and host builds continue using their standard libc symbol.
    #[no_mangle]
    pub extern "C" fn getauxval(kind: libc::c_ulong) -> libc::c_ulong {
        let previous = errno();
        let result = query(&mut CurrentProcess, kind as usize);
        let (value, error) = match result {
            Ok(value) => (value as libc::c_ulong, previous),
            Err(error) => (0, error),
        };
        unsafe {
            *libc::__errno_location() = error;
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        bytes: Vec<u8>,
        position: usize,
        interrupted_open: bool,
        interrupted_read: bool,
        closes: usize,
        close_error: Option<i32>,
    }

    impl Fixture {
        fn new(pairs: &[(usize, usize)]) -> Self {
            Self {
                bytes: pairs
                    .iter()
                    .flat_map(|(tag, value)| {
                        tag.to_ne_bytes().into_iter().chain(value.to_ne_bytes())
                    })
                    .collect(),
                position: 0,
                interrupted_open: true,
                interrupted_read: true,
                closes: 0,
                close_error: None,
            }
        }
    }

    impl ProcessAuxv for Fixture {
        fn open(&mut self) -> Result<i32, i32> {
            if core::mem::take(&mut self.interrupted_open) {
                Err(libc::EINTR)
            } else {
                Ok(7)
            }
        }
        fn read(&mut self, fd: i32, buffer: &mut [u8]) -> Result<usize, i32> {
            assert_eq!(fd, 7);
            if core::mem::take(&mut self.interrupted_read) {
                return Err(libc::EINTR);
            }
            // One byte per read deliberately splits both native-word fields.
            if let Some(byte) = self.bytes.get(self.position) {
                buffer[0] = *byte;
                self.position += 1;
                Ok(1)
            } else {
                Ok(0)
            }
        }
        fn close(&mut self, fd: i32) -> Result<(), i32> {
            assert_eq!(fd, 7);
            self.closes += 1;
            self.close_error.map_or(Ok(()), Err)
        }
    }

    #[test]
    fn partial_reads_and_interrupts_preserve_zero_and_nonzero_values() {
        for expected in [0, 4096] {
            let mut source = Fixture::new(&[(4, 123), (51, expected), (0, 0)]);
            assert_eq!(query(&mut source, 51), Ok(expected));
            assert_eq!(source.closes, 1);
        }
    }

    #[test]
    fn null_terminator_and_truncated_records_fail_and_close() {
        let mut missing = Fixture::new(&[(4, 123), (0, 0), (51, 4096)]);
        assert_eq!(query(&mut missing, 51), Err(libc::ENOENT));
        assert_eq!(missing.closes, 1);
        let mut truncated = Fixture::new(&[(51, 4096)]);
        truncated.bytes.pop();
        assert_eq!(query(&mut truncated, 51), Err(libc::EIO));
        assert_eq!(truncated.closes, 1);
    }

    #[test]
    fn close_interrupt_is_not_retried_and_scan_is_bounded() {
        let mut source = Fixture::new(&[(51, 4096)]);
        source.close_error = Some(libc::EINTR);
        assert_eq!(query(&mut source, 51), Err(libc::EINTR));
        assert_eq!(source.closes, 1);
        let mut reads = 0;
        assert_eq!(
            scan(
                |buffer| {
                    reads += 1;
                    buffer[..WORD].copy_from_slice(&4usize.to_ne_bytes());
                    buffer[WORD..].fill(0);
                    Ok(PAIR)
                },
                51
            ),
            Err(libc::E2BIG)
        );
        assert_eq!(reads, MAX_PAIRS);
    }
}
