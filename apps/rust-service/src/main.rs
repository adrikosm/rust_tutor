use rust_tutor_service::{
    AppState, Config, ToolchainStatus, app,
    db::{Database, default_database_path},
};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("Startup failed: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let database = Database::open(&default_database_path()?).await?;
    database
        .import_runtime_graph(rust_tutor_service::graph::embedded())
        .await?;
    let toolchain = ToolchainStatus::discover().await;
    let state = AppState::new(&config, toolchain)?.with_database(database);
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    println!("Rust Tutor service listening on http://{}", config.bind);
    axum::serve(listener, app(state, config.web_dist)).await?;
    Ok(())
}
