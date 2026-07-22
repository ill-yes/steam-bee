import { resolve } from "node:path";

export const dataDirectory = resolve(process.env.DATA_DIR ?? "./data");
