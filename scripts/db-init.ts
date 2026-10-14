/**
 * Create the database schema.
 *
 *   npm run db:init
 *
 * Requires DATABASE_URL (or POSTGRES_URL) in the environment or .env.local.
 */
import { hasDatabase, initSchema } from "../lib/db";

async function main() {
  if (!hasDatabase) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "Add it to .env.local (see .env.example) or run `vercel env pull .env.local`.",
    );
    process.exit(1);
  }

  await initSchema();
  console.log("Schema created (tables: vacancies, scrape_runs).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
