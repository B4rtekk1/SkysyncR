use skysync::db::migrations;

#[tokio::main]
async fn main() -> Result<(), sqlx::migrate::MigrateError> {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    skysync::observability::init_tracing();

    let pool = skysync::app::connect().await;
    migrations::run(&pool).await?;
    tracing::info!("database migrations completed");

    Ok(())
}
