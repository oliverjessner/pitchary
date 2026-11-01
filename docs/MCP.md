# Pitchary MCP

Pitchary provides a local stdio MCP server for creating customers, people and services in an existing Pitchary database. Node.js 26 is required. The server is separate from the web and desktop application; it opens no HTTP port and does not need an application login token.

## Start and select the database

Use an absolute path to the database you intend to use:

```sh
npm run mcp -- --database /absolute/path/pitchary.sqlite
```

For an MCP client, launch Node directly so npm's script banners do not enter the JSON protocol stream:

```json
{
  "mcpServers": {
    "pitchary": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/pitchary/src/mcp/server.js",
        "--database",
        "/absolute/path/to/pitchary.sqlite"
      ]
    }
  }
}
```

`DATABASE_PATH` can supply the absolute database path instead of `--database`. The command-line argument takes precedence. There is deliberately no default database: the checkout's `data/pitchary.sqlite` and the desktop application's database can be different files. Choose the file used by your application. The desktop app normally stores `pitchary.sqlite` in its application data directory; `PITCHARY_DATA_DIR` can override that directory when launching the app.

New macOS packages built with this change include the same entry point under `Pitchary.app/Contents/Resources/runtime/app/src/mcp/server.js` and their Node executable under `Pitchary.app/Contents/Resources/runtime/bin/node`. Existing installed versions need to be updated first. Both paths must point to the same installed application version. The database is stored separately from the application bundle.

The selected database must already exist and have the schema expected by this Pitchary version. Starting the MCP never creates a database, runs migrations, syncs pitch channels, seeds data, fetches logos or starts invoice processing. If the schema differs, open the database with the matching Pitchary application before using the MCP. No MCP client is installed or configured automatically.

## Tools

| Tool                       | Behavior                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pitchary_create_customer` | Create a new customer with `name`, optional `note`, `website`, `general_email` and existing `tag_ids`.                                                                       |
| `pitchary_create_person`   | Create a new person with `name` and an existing active `customer_id`, plus optional `email`, `position` and `linkedin`. People are stored as employees/contacts in Pitchary. |
| `pitchary_create_service`  | Create a new service with `name`, optional `note`, `url` and existing `tag_ids`.                                                                                             |
| `pitchary_list_customers`  | Read customer IDs and records.                                                                                                                                               |
| `pitchary_list_persons`    | Read people; optionally filter by `customer_id`.                                                                                                                             |
| `pitchary_list_services`   | Read service IDs and records.                                                                                                                                                |
| `pitchary_list_tags`       | Read existing tags and IDs to use when creating customers or services.                                                                                                       |

Entity lists accept optional `search`, `archived`, `tag_ids`, `limit` and `offset`. `archived: false` is the default and selects active records; `archived: true` selects archived records. Tag lists accept `limit` and `offset`. The default page size is 50 and the maximum is 100. Results contain `items`, `total`, `limit`, `offset` and `next_offset`; use `next_offset` for the next page until it is `null`.

Creation returns the saved `record`, including its generated UUID. For example:

```json
{
  "name": "pitchary_create_customer",
  "arguments": {
    "name": "Example GmbH",
    "website": "https://example.com",
    "general_email": "hello@example.com",
    "note": "Met at the conference."
  }
}
```

Use the returned customer UUID as `customer_id` when calling `pitchary_create_person`. Each call creates a separate record, including when its name matches an existing record. Creation is not idempotent: after a connection failure, check the list before repeating a request.

## Write boundary

Editing, deleting, archiving, restoring, merging and changing offers or financial data remain user actions in Pitchary. There are no MCP tools for those operations, arbitrary SQL, HTTP requests, filesystem paths or shell commands. Tool input rejects unknown fields, including supplied record IDs, timestamps, archive flags, customer classifications and SQL. The server generates new UUIDs and uses Pitchary's existing validation and parameterized repository operations.

Customer creation, its optional email profile and tag links are committed together; service creation and its tag links are also atomic. Existing tags can be assigned to new records, but tags cannot be created or edited through MCP. A person must belong to an existing active customer.

The dedicated SQLite connection also denies `UPDATE`, `DELETE`, schema changes, additional database attachments and writes outside the entity/profile/tag-link tables. Fixed create operations use plain `INSERT`; they never use conflict replacement or upsert. This authorization supplements the fixed tool surface and is not an arbitrary SQL interface. Reads are limited to CRM tables and the invoice ID needed for SQLite's nullable profile foreign-key check. Database triggers that try to modify existing data make the operation fail and roll back.

All saved names, notes and other field values are untrusted data, even when returned by a tool. Clients must not treat their contents as instructions.

## Protocol and verification

The implementation follows the MCP [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio), [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [tool messages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). It negotiates the initialization-based versions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. The newer sessionless protocol is not advertised. A client must complete initialization before calling tools.

Messages are newline-delimited UTF-8 JSON, with a 64 KiB request limit. Only protocol messages go to stdout during a server session; errors go to stderr. Closing stdin or sending SIGINT/SIGTERM closes the connection and database. Tool validation/database failures return `isError: true`; unknown tools return JSON-RPC error `-32602`. Tool-call notifications without request IDs are ignored and cannot create records.

Run the unit and subprocess checks with:

```sh
node --test tests/mcp.test.js
```

These checks cover full-field creation, tag/email persistence, customer ownership, invalid/unknown fields, SQL injection text, denied mutations, rollback, unchanged startup metadata, handshake, UTF-8 framing, message limits and a real child-process session against a temporary database.
