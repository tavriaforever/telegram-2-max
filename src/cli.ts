#!/usr/bin/env node
import { Command } from "commander";
import { runUpload } from "./commands/upload-cmd.js";
import { runPost } from "./commands/post-cmd.js";
import { runReattach } from "./commands/reattach-cmd.js";
import { runSyncMids } from "./commands/sync-mids-cmd.js";
import { parseOnlyMessageIds } from "./cli-parse.js";

const program = new Command();

program.name("max-migrate").description("Migrate a Telegram dump to Max");

program
  .command("upload")
  .description("Upload media to Max and fill migration-state.json")
  .option("--token <token>", "Max bot token", process.env.MAX_BOT_TOKEN)
  .option("--dump <dir>", "Dump directory (contains result.json)", "telegram-dump")
  .option("--state <path>", "Path to migration-state.json (default: <dump>/migration-state.json)")
  .option("--strict", "Stop on the first upload error")
  .option("--dry", "Dry run: only create/update state and list files that would be uploaded")
  .option(
    "--only-messages <ids>",
    "Only these message ids from the dump (comma-separated), e.g. 3,7,12",
  )
  .option(
    "--reset-failed",
    "Reset upload errors (error→pending) for retry",
  )
  .action(
    async (o: {
      token?: string;
      dump: string;
      state?: string;
      strict?: boolean;
      dry?: boolean;
      onlyMessages?: string;
      resetFailed?: boolean;
    }) => {
    const token = o.dry ? "" : (o.token?.trim() ?? "");
    if (!token) {
      if (!o.dry) {
        console.error("Set --token or MAX_BOT_TOKEN");
        process.exit(1);
      }
    }
    await runUpload({
      token: token || "dry-run",
      dumpDir: o.dump,
      statePath: o.state,
      strict: o.strict,
      dry: o.dry,
      onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
      resetFailed: o.resetFailed,
    });
  });

program
  .command("reattach")
  .description(
    "Add attachments to already posted messages (PUT /messages), e.g. if a post went out without video",
  )
  .option("--token <token>", "Max bot token", process.env.MAX_BOT_TOKEN)
  .option("--dump <dir>", "Dump directory", "telegram-dump")
  .option("--state <path>", "Path to migration-state.json")
  .option("--only-messages <ids>", "Only these dump message ids (comma-separated)")
  .option(
    "--mid <id>",
    "Message id in Max (if state has no maxMessageId); only with a single id in --only-messages",
  )
  .option("--force", "Run reattach even if already marked attachmentsApplied")
  .option("--dry", "Print PUT bodies without calling the API")
  .option(
    "--chat-author-mode",
    "Same text header as post --chat-author-mode",
  )
  .action(
    async (o: {
      token?: string;
      dump: string;
      state?: string;
      onlyMessages?: string;
      mid?: string;
      force?: boolean;
      dry?: boolean;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.dry ? "" : (o.token?.trim() ?? "");
      if (!token && !o.dry) {
        console.error("Set --token or MAX_BOT_TOKEN");
        process.exit(1);
      }
      await runReattach({
        token: token || "dry",
        dumpDir: o.dump,
        statePath: o.state,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        mid: o.mid,
        force: o.force,
        dry: o.dry,
        chatAuthorMode: !!o.chatAuthorMode,
      });
    },
  );

program
  .command("sync-mids")
  .description(
    "Fill maxMessageId: fetch chat history (GET /messages) and match posts by text",
  )
  .option("--token <token>", "Max bot token", process.env.MAX_BOT_TOKEN)
  .option("--chat-id <id>", "Chat id", process.env.MAX_CHAT_ID)
  .option("--dump <dir>", "Dump directory", "telegram-dump")
  .option("--state <path>", "Path to migration-state.json")
  .option("--only-messages <ids>", "Only these dump ids")
  .option("--force", "Overwrite maxMessageId even if already set")
  .option("--dry", "Print matches without writing state")
  .option("--max-pages <n>", "Max GET /messages pages", "800")
  .option(
    "--chat-author-mode",
    "Match the same way as post --chat-author-mode",
  )
  .action(
    async (o: {
      token?: string;
      chatId: string;
      dump: string;
      state?: string;
      onlyMessages?: string;
      force?: boolean;
      dry?: boolean;
      maxPages?: string;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.token?.trim();
      if (!token && !o.dry) {
        console.error("Set --token");
        process.exit(1);
      }
      if (o.chatId == null || o.chatId === "") {
        console.error("Set --chat-id or MAX_CHAT_ID");
        process.exit(1);
      }
      const chatId = parseInt(String(o.chatId), 10);
      if (Number.isNaN(chatId)) {
        console.error("Invalid --chat-id");
        process.exit(1);
      }
      const maxPages = parseInt(o.maxPages ?? "800", 10) || 800;
      await runSyncMids({
        token: token || "",
        chatId,
        dumpDir: o.dump,
        statePath: o.state,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        force: o.force,
        dry: o.dry,
        maxPages,
        chatAuthorMode: !!o.chatAuthorMode,
      });
    },
  );

program
  .command("post")
  .description("Post messages to a Max group chat using migration state")
  .option("--token <token>", "Max bot token", process.env.MAX_BOT_TOKEN)
  .option(
    "--chat-id <id>",
    "Max group chat id",
    process.env.MAX_CHAT_ID,
  )
  .option("--dump <dir>", "Dump directory", "telegram-dump")
  .option("--state <path>", "Path to migration-state.json")
  .option(
    "--skip-if-media-missing",
    "Do not post messages whose files are not all uploaded",
  )
  .option("--dry", "Dry run: show messages that would be sent, without calling the API")
  .option(
    "--only-messages <ids>",
    "Only these message ids (comma-separated); others are left unchanged",
  )
  .option(
    "--chat-author-mode",
    "Post header: «Name · DD.MM.YYYY HH:MM» from dump `from` field",
  )
  .action(
    async (o: {
      token?: string;
      chatId: string;
      dump: string;
      state?: string;
      skipIfMediaMissing?: boolean;
      dry?: boolean;
      onlyMessages?: string;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.dry ? "" : (o.token?.trim() ?? "");
      if (!token && !o.dry) {
        console.error("Set --token or MAX_BOT_TOKEN");
        process.exit(1);
      }
      if (o.chatId == null || o.chatId === "") {
        console.error("Set --chat-id or MAX_CHAT_ID");
        process.exit(1);
      }
      const chatId = parseInt(String(o.chatId), 10);
      if (Number.isNaN(chatId)) {
        console.error("Invalid --chat-id");
        process.exit(1);
      }
      await runPost({
        token: token || "dry-run",
        chatId,
        dumpDir: o.dump,
        statePath: o.state,
        skipIfMediaMissing: o.skipIfMediaMissing,
        dry: o.dry,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        chatAuthorMode: !!o.chatAuthorMode,
      });
    });

program.parse();
