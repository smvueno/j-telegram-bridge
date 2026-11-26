// helper for the concurrency test: writes N sessions with its own prefix
import { State } from "../../state";
const [file, prefix, n] = process.argv.slice(2);
const s = new State(file!);
for (let i = 0; i < Number(n); i++) s.setSession(`${prefix}:${i}`, `id-${i}`);
