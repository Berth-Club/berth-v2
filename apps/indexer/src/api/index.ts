import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";

/**
 * The HTTP API the web app reads from.
 *   /graphql  — GraphQL over the schema
 *   /sql/*    — typed SQL-over-HTTP client
 * No separate API service needed; Ponder serves this.
 */
const app = new Hono();

app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
