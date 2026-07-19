use skysyncr::app::run_server;
use skysyncr::crypto::email::log_email_configuration_status;

#[tokio::main]
async fn main() {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    skysyncr::observability::init_tracing();
    log_email_configuration_status();

    run_server().await;
}
