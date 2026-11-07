# MCP server: authentication and destructive actions

`/mcp` gives agents three tools, `search_notes`, `create_note` and `delete_note`, on the same note service the web app uses. This note covers what protects it today and how I'd add real authentication and safer deletes.

## What's in place today

This is a local demo, so there is **no authentication**: anyone who can reach the port can use the tools. These protections are in place:

- **Origin checks.** Browser requests are only accepted from the web app's origin (`CORS_ALLOWED_ORIGIN`). This uses Go's `http.CrossOriginProtection`. Other sites get `403`. Agents send no `Origin` header and are allowed.
- **DNS-rebinding protection.** The SDK rejects requests that reach a localhost address with a non-localhost `Host`.
- **Limits.** Request bodies are capped at 256 KB, and the same validation runs as for REST (title, body and tag rules).
- **Tool hints.** `search_notes` is `readOnlyHint`. `delete_note` is `destructiveHint` and `idempotentHint`. All three are `openWorldHint: false`. Clients such as Claude Code use these hints to decide when to ask the user before running a tool.
- **Explicit confirm.** `delete_note` refuses unless `confirm: true` is passed. The tool error tells the agent to check with the user first. Each successful delete is logged with its id and title.
- **Safe errors.** Validation and not-found errors come back as tool errors (`isError: true`) that the agent can read and fix. Unexpected errors are logged and returned as a generic message.

## Authentication: how I'd add it

I'd follow the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), which is OAuth 2.1 with this server as the *resource server*:

1. **Use the team's existing identity provider**, such as Entra ID, Okta or Auth0, as the authorization server. Don't build login into the notes app.
2. **Advertise it.** Serve Protected Resource Metadata at `/.well-known/oauth-protected-resource` (the SDK has `auth.ProtectedResourceMetadataHandler`). Answer `401` with a `WWW-Authenticate` header that points to it, so clients like Claude Code can run the OAuth flow themselves.
3. **Check every request.** Wrap `/mcp` in `auth.RequireBearerToken`. Verify the token's signature (JWKS), issuer, expiry and **audience**: the token must have been issued *for this server* (RFC 8707 resource indicators). Never accept tokens in query strings, and never pass the client's token on to other services.
4. **Use scopes per tool:** `notes:read` for `search_notes`, `notes:write` for `create_note`, `notes:delete` for `delete_note`. Each tool checks the scopes in `auth.TokenInfoFromContext`, and `tools/list` only shows the tools the token allows. Most agents would never get `notes:delete`.
5. **Record who did what.** Store `createdBy` and `deletedBy` (the user and the client id) on notes, so people can see whether a person or an agent made a change.
6. **Use one model for REST and MCP.** The web app would use the same identity provider (OIDC login). Permission checks belong in `note.Service`, so both entry points enforce the same rules.

For a purely local setup, a stdio transport avoids network authentication entirely, because the agent starts the server as a child process.

## Destructive actions: how I'd make deletes safer

Hints and `confirm` rely on the agent and its client behaving well. The stronger fixes belong on the server:

- **Soft delete with undo.** Mark notes as deleted (`deletedAt`, `deletedBy`) instead of removing them. Keep them in a trash for 30 days, and add `restore_note` plus an "Undo" button in the web app's toast. A mistaken agent delete then costs nothing. This is the change I'd make first.
- **A separate permission.** Use the `notes:delete` scope above, so deleting is something a user grants on purpose.
- **Asking the user from the server.** Clients that support MCP *elicitation* can be asked directly: "Delete 'Sprint 14 planning'? Yes/No". The answer comes from the person, not the model, which is stronger than a `confirm` flag the model can set itself. Elicitation needs a session, so `/mcp` would switch from stateless to stateful mode. The `confirm` flag would stay as a fallback for clients without elicitation.
- **Limits and an audit trail.** Rate-limit deletes per identity, for example 5 a minute. Don't offer bulk delete to agents at all. Write every delete to an audit log (who, which client, when, what) that the team can review.
