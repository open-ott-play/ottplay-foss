// The static musl server retains a large guide snapshot while parsing and
// matching. Route Rust and QuickJS allocations through the same allocator;
// the server's target dependency enables QuickJS's supported Rust callbacks.
#[cfg(all(target_os = "linux", target_env = "musl"))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
