use skysyncr::app::run_server;

#[tokio::main]
async fn main() {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    skysyncr::observability::init_tracing();

    run_server().await;
}
