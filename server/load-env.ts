import fs from "fs";
import dotenv from "dotenv";
import { getYantraAppPaths } from "../src/lib/config/app-paths";

for (const filePath of getYantraAppPaths().envFiles) {
  if (!fs.existsSync(filePath)) continue;

  dotenv.config({
    path: filePath,
    override: false,
  });
}
