// Modified by OttPlay FOSS: bound metadata acquisition resources.
use std::{collections::HashSet, net::SocketAddr, sync::Arc};

use anyhow::Context;
use buffers::ByteBufOwned;
use futures::{Stream, StreamExt, stream::FuturesUnordered};
use librqbit_core::torrent_metainfo::TorrentMetaV1Info;
use tracing::{Instrument, debug, debug_span};

use crate::{
    peer_connection::PeerConnectionOptions, peer_info_reader, spawn_utils::BlockingSpawner,
    stream_connect::StreamConnector,
};
use librqbit_core::hash_id::Id20;

// Local adapter bounds. Keep metadata discovery within the native service budget.
const MAX_METADATA_READERS: usize = 16;
const MAX_METADATA_PEERS: usize = 1024;

fn admit_metadata_peer(seen: &mut HashSet<SocketAddr>, addr: SocketAddr) -> bool {
    seen.len() < MAX_METADATA_PEERS && seen.insert(addr)
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
pub enum ReadMetainfoResult<Rx> {
    Found {
        info: TorrentMetaV1Info<ByteBufOwned>,
        info_bytes: ByteBufOwned,
        rx: Rx,
        seen: HashSet<SocketAddr>,
    },
    ChannelClosed {
        #[allow(dead_code)]
        seen: HashSet<SocketAddr>,
    },
}

pub async fn read_metainfo_from_peer_receiver<A: Stream<Item = SocketAddr> + Unpin>(
    peer_id: Id20,
    info_hash: Id20,
    initial_addrs: Vec<SocketAddr>,
    addrs_stream: A,
    peer_connection_options: Option<PeerConnectionOptions>,
    connector: Arc<StreamConnector>,
    client_name_and_version: String,
) -> ReadMetainfoResult<A> {
    let mut seen = HashSet::<SocketAddr>::new();
    let mut addrs = addrs_stream;

    let semaphore = tokio::sync::Semaphore::new(MAX_METADATA_READERS);

    let read_info_guarded = |addr| {
        let semaphore = &semaphore;
        let connector = connector.clone();
        let client_name_and_version = client_name_and_version.clone();
        async move {
            let token = semaphore.acquire().await?;
            let ret = peer_info_reader::read_metainfo_from_peer(
                addr,
                peer_id,
                info_hash,
                peer_connection_options,
                // This shouldn't be called anyway as we aren't reading/writing to disk, so it's
                // ok not to use a shared one.
                BlockingSpawner::new(1),
                connector,
                client_name_and_version,
            )
            .instrument(debug_span!("read_metainfo_from_peer", ?addr))
            .await
            .with_context(|| format!("error reading metainfo from {addr}"));
            drop(token);
            ret
        }
    };

    let mut unordered = FuturesUnordered::new();

    for a in initial_addrs.into_iter().take(MAX_METADATA_PEERS) {
        if admit_metadata_peer(&mut seen, a) {
            unordered.push(read_info_guarded(a));
        }
    }

    let mut addrs_completed = false;

    loop {
        if addrs_completed && unordered.is_empty() {
            return ReadMetainfoResult::ChannelClosed { seen };
        }

        tokio::select! {
            done = unordered.next(), if !unordered.is_empty() => {
                match done {
                    Some(Ok((info, info_bytes))) => return ReadMetainfoResult::Found { info, info_bytes, seen, rx: addrs },
                    Some(Err(e)) => {
                        debug!("{:#}", e);
                    },
                    None => unreachable!()
                }
            }

            next_addr = addrs.next(), if !addrs_completed => {
                match next_addr {
                    Some(addr) => {
                        if admit_metadata_peer(&mut seen, addr) {
                            unordered.push(read_info_guarded(addr));
                        }
                        continue;
                    },
                    None => {
                        addrs_completed = true;
                    },
                }
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use dht::{DhtBuilder, Id20};
    use librqbit_core::peer_id::generate_peer_id;

    use super::*;
    use std::{
        str::FromStr,
        sync::{Arc, Once},
    };

    static LOG_INIT: Once = Once::new();

    fn init_logging() {
        #[allow(unused_must_use)]
        LOG_INIT.call_once(|| {
            // pretty_env_logger::try_init();
        })
    }

    #[tokio::test]
    #[ignore]
    async fn read_metainfo_from_dht() {
        init_logging();

        let info_hash = Id20::from_str("cab507494d02ebb1178b38f2e9d7be299c86b862").unwrap();
        let dht = DhtBuilder::new().await.unwrap();

        let peer_rx = dht.get_peers(info_hash, None);
        let peer_id = generate_peer_id(b"-xx1234-");
        match read_metainfo_from_peer_receiver(
            peer_id,
            info_hash,
            Vec::new(),
            peer_rx,
            None,
            Arc::new(StreamConnector::new(Default::default()).await.unwrap()),
            crate::client_name_and_version().to_owned(),
        )
        .await
        {
            ReadMetainfoResult::Found { info, .. } => dbg!(info),
            ReadMetainfoResult::ChannelClosed { .. } => todo!("should not have happened"),
        };
    }
}

#[cfg(test)]
mod resource_bounds_tests {
    use super::*;

    #[test]
    fn metadata_peer_admission_deduplicates_and_stops_at_budget() {
        let mut seen = HashSet::new();
        let first: SocketAddr = "127.0.0.1:1".parse().unwrap();
        assert!(admit_metadata_peer(&mut seen, first));
        assert!(!admit_metadata_peer(&mut seen, first));
        for port in 2..=MAX_METADATA_PEERS {
            assert!(admit_metadata_peer(
                &mut seen,
                SocketAddr::from(([127, 0, 0, 1], port as u16)),
            ));
        }
        assert!(!admit_metadata_peer(
            &mut seen,
            SocketAddr::from(([127, 0, 0, 1], MAX_METADATA_PEERS as u16 + 1)),
        ));
        assert_eq!(seen.len(), MAX_METADATA_PEERS);
    }

    #[tokio::test]
    async fn metadata_reader_concurrency_stays_bounded_for_many_local_peers() {
        use std::time::Duration;
        use tokio::{net::TcpListener, sync::mpsc, task::JoinSet};

        let (tx, mut accepted) = mpsc::unbounded_channel();
        let mut servers = JoinSet::new();
        let mut addresses = Vec::new();
        for _ in 0..MAX_METADATA_READERS + 8 {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            addresses.push(listener.local_addr().unwrap());
            let tx = tx.clone();
            servers.spawn(async move {
                let (_stream, _) = listener.accept().await.unwrap();
                tx.send(()).unwrap();
                std::future::pending::<()>().await;
            });
        }
        drop(tx);
        let connector = Arc::new(
            StreamConnector::new(crate::stream_connect::StreamConnectorArgs {
                enable_tcp: true,
                ..Default::default()
            })
            .await
            .unwrap(),
        );
        let result = tokio::spawn(read_metainfo_from_peer_receiver(
            "1111111111111111111111111111111111111111".parse().unwrap(),
            "2222222222222222222222222222222222222222".parse().unwrap(),
            addresses,
            futures::stream::pending(),
            Some(PeerConnectionOptions {
                read_write_timeout: Some(Duration::from_secs(30)),
                ..Default::default()
            }),
            connector,
            "resource-test".to_owned(),
        ));
        tokio::time::timeout(Duration::from_secs(5), async {
            for _ in 0..MAX_METADATA_READERS {
                accepted.recv().await.unwrap();
            }
        })
        .await
        .expect("metadata connections started");
        assert!(
            tokio::time::timeout(Duration::from_millis(100), accepted.recv())
                .await
                .is_err()
        );
        result.abort();
        let _ = result.await;
        servers.abort_all();
        while servers.join_next().await.is_some() {}
    }
}
