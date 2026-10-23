//! Compile and exercise the upstream Windows ZIP extraction method in isolation.
//! This test adapter cannot launch an installer and does not enable app features.

// The unmodified production method refers to its crate's error type.
#[cfg(test)]
pub(crate) use tests::Error;

#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, io::Cursor, path::PathBuf};

    #[derive(Debug)]
    pub(crate) enum Error {
        Io(std::io::Error),
        Zip(zip::result::ZipError),
        BinaryNotFoundInArchive,
    }

    impl From<std::io::Error> for Error {
        fn from(value: std::io::Error) -> Self {
            Self::Io(value)
        }
    }

    impl From<zip::result::ZipError> for Error {
        fn from(value: zip::result::ZipError) -> Self {
            Self::Zip(value)
        }
    }

    type Result<T> = std::result::Result<T, Error>;

    #[derive(Debug, PartialEq)]
    enum WindowsUpdaterType {
        Nsis(PathBuf),
        Msi(PathBuf),
    }

    impl WindowsUpdaterType {
        fn nsis(path: PathBuf, temporary: Option<tempfile::TempPath>) -> Self {
            assert!(temporary.is_none());
            Self::Nsis(path)
        }

        fn msi(path: PathBuf, temporary: Option<tempfile::TempPath>) -> Self {
            assert!(temporary.is_none());
            Self::Msi(path)
        }
    }

    struct Update {
        directory: PathBuf,
    }

    impl Update {
        fn make_temp_dir(&self) -> Result<PathBuf> {
            std::fs::create_dir(&self.directory)?;
            Ok(self.directory.clone())
        }
    }

    include!(concat!(env!("OUT_DIR"), "/extract_zip.rs"));

    fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, content) in files {
            writer.start_file(name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn fixture() -> (tempfile::TempDir, Update) {
        let temp = tempfile::tempdir().unwrap();
        let update = Update {
            directory: temp.path().join("output"),
        };
        (temp, update)
    }

    #[test]
    fn selects_nsis_and_preserves_installer_bytes() {
        let (_temp, update) = fixture();
        let result = update.extract_zip(&archive(&[("setup.exe", b"installer bytes")]));
        assert_eq!(
            result.unwrap(),
            WindowsUpdaterType::Nsis(update.directory.join("setup.exe"))
        );
        assert_eq!(
            std::fs::read(update.directory.join("setup.exe")).unwrap(),
            b"installer bytes"
        );
    }

    #[test]
    fn selects_msi_with_unicode_and_spaces() {
        let (_temp, update) = fixture();
        let name = "OTT player é.msi";
        assert_eq!(
            update
                .extract_zip(&archive(&[(name, b"msi bytes")]))
                .unwrap(),
            WindowsUpdaterType::Msi(update.directory.join(name))
        );
        assert_eq!(
            std::fs::read(update.directory.join(name)).unwrap(),
            b"msi bytes"
        );
    }

    #[test]
    fn ignores_support_files_when_selecting_installer() {
        let (_temp, update) = fixture();
        let files = [
            ("readme.txt", b"info".as_slice()),
            ("setup.exe", b"exe".as_slice()),
        ];
        assert_eq!(
            update.extract_zip(&archive(&files)).unwrap(),
            WindowsUpdaterType::Nsis(update.directory.join("setup.exe"))
        );
        assert_eq!(
            std::fs::read(update.directory.join("readme.txt")).unwrap(),
            b"info"
        );
    }

    #[test]
    fn empty_archive_reports_no_installer() {
        let (_temp, update) = fixture();
        assert!(matches!(
            update.extract_zip(&archive(&[])),
            Err(Error::BinaryNotFoundInArchive)
        ));
    }

    #[test]
    fn archive_without_installer_reports_no_installer() {
        let (_temp, update) = fixture();
        assert!(matches!(
            update.extract_zip(&archive(&[("notes.txt", b"notes")])),
            Err(Error::BinaryNotFoundInArchive)
        ));
    }

    #[test]
    fn nested_installer_is_not_silently_selected() {
        let (_temp, update) = fixture();
        assert!(matches!(
            update.extract_zip(&archive(&[("folder/setup.exe", b"exe")])),
            Err(Error::BinaryNotFoundInArchive)
        ));
        assert_eq!(
            std::fs::read(update.directory.join("folder/setup.exe")).unwrap(),
            b"exe"
        );
    }

    #[test]
    fn malformed_archive_returns_zip_error() {
        let (_temp, update) = fixture();
        match update.extract_zip(b"this is not a zip archive") {
            Err(Error::Zip(error)) => assert!(!error.to_string().is_empty()),
            other => panic!("expected ZIP error, got {other:?}"),
        }
    }

    #[test]
    fn unavailable_destination_returns_io_error() {
        let (_temp, update) = fixture();
        std::fs::write(&update.directory, b"existing file").unwrap();
        match update.extract_zip(&archive(&[("setup.exe", b"exe")])) {
            Err(Error::Io(error)) => assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists),
            other => panic!("expected directory IO error, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn privileged_unix_mode_bits_are_cleared() {
        use std::os::unix::fs::PermissionsExt;
        let (_temp, update) = fixture();
        let mut bytes = archive(&[("setup.exe", b"inert test fixture")]);
        // ZipWriter intentionally masks these bits. Set only this one-entry
        // fixture's central-directory mode to exercise the reader's boundary.
        let directory = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
        bytes[directory + 5] = 3; // ZIP creator OS: Unix.
        bytes[directory + 38..directory + 42]
            .copy_from_slice(&((0o100755u32 | 0o7000) << 16).to_le_bytes());
        let recorded_mode =
            u32::from_le_bytes(bytes[directory + 38..directory + 42].try_into().unwrap()) >> 16;
        assert_eq!(recorded_mode & 0o7000, 0o7000);

        update.extract_zip(&bytes).unwrap();
        let mode = std::fs::metadata(update.directory.join("setup.exe"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o7000,
            0,
            "untrusted archive must not set privileged mode bits"
        );
        assert_eq!(
            std::fs::read(update.directory.join("setup.exe")).unwrap(),
            b"inert test fixture"
        );
    }

    #[cfg(unix)]
    #[test]
    fn outside_symlink_cannot_expose_or_chmod_sibling() {
        use std::os::unix::fs::PermissionsExt;
        let (temp, update) = fixture();
        let sibling = temp.path().join("sibling.txt");
        std::fs::write(&sibling, b"unchanged sibling fixture").unwrap();
        std::fs::set_permissions(&sibling, std::fs::Permissions::from_mode(0o600)).unwrap();
        let before_mode = std::fs::metadata(&sibling).unwrap().permissions().mode();
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink(
                "linked.exe",
                "../sibling.txt",
                zip::write::SimpleFileOptions::default().unix_permissions(0o777),
            )
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();

        let result = update.extract_zip(&bytes);
        assert_eq!(
            std::fs::read(&sibling).unwrap(),
            b"unchanged sibling fixture"
        );
        assert_eq!(
            std::fs::metadata(&sibling).unwrap().permissions().mode(),
            before_mode,
            "archive permissions must not be applied through an outside symlink"
        );
        assert!(
            std::fs::symlink_metadata(update.directory.join("linked.exe")).is_err(),
            "an outside symlink must not be exposed in the extraction directory"
        );
        assert!(
            matches!(result, Err(Error::Zip(_))),
            "outside symlink must be rejected"
        );
    }
}

#[cfg(test)]
mod tls;
