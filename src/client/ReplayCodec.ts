import { GameEndInfo, GameRecord, Intent, Turn } from "../core/Schemas";

export interface CompactGameRecord {
  replayVersion: string;
  info: GameEndInfo;
  turns: Array<{ t: number; i: Intent[] }>;
  version: "v0.0.2";
  gitCommit: string;
}

export async function encodeReplay(record: GameRecord): Promise<string> {
  const sparseTurns = record.turns
    .filter((turn) => turn.intents.length > 0 || turn.hash !== undefined)
    .map((turn) => ({ t: turn.turnNumber, i: turn.intents }));

  const compact: CompactGameRecord = {
    replayVersion: "TRv1",
    info: record.info,
    turns: sparseTurns,
    version: record.version,
    gitCommit: record.gitCommit,
  };

  // 2. Serialize to JSON (handle BigInt values)
  const json = JSON.stringify(compact, (key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  const stream = new Blob([json]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(compressedStream).arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(compressed)));
  return "TRv1:" + base64;
}

export async function decodeReplay(encoded: string): Promise<GameRecord> {
  if (!encoded.startsWith("TRv1:")) {
    throw new Error("Invalid replay format");
  }

  const base64 = encoded.slice(5);
  let compressed: Uint8Array;
  try {
    compressed = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch (error) {
    throw new Error("Invalid Base64 encoding");
  }

  const decompressStream = new Blob([
    compressed.buffer as ArrayBuffer,
  ]).stream();
  const decompressedStream = decompressStream.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const decompressed = await new Response(decompressedStream).arrayBuffer();

  const json = new TextDecoder().decode(decompressed);
  let compact: CompactGameRecord;
  try {
    compact = JSON.parse(json);
  } catch (error) {
    throw new Error("Invalid JSON in replay data");
  }

  if (compact.replayVersion !== "TRv1") {
    throw new Error("Unsupported replay version: " + compact.replayVersion);
  }

  const fullTurns: Turn[] = [];
  let sparseIndex = 0;

  for (let t = 0; t < compact.info.num_turns; t++) {
    if (
      sparseIndex < compact.turns.length &&
      compact.turns[sparseIndex].t === t
    ) {
      fullTurns.push({
        turnNumber: t,
        intents: compact.turns[sparseIndex].i,
        hash: null,
      });
      sparseIndex++;
    } else {
      fullTurns.push({
        turnNumber: t,
        intents: [],
        hash: null,
      });
    }
  }

  const gameRecord: GameRecord = {
    info: compact.info,
    turns: fullTurns,
    version: compact.version,
    gitCommit: compact.gitCommit,
  };

  return gameRecord;
}

export function isCompressionSupported(): boolean {
  return typeof CompressionStream !== "undefined";
}
