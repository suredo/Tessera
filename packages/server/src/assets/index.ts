// Docs: docs/code/server/assets.md
// The asset store: images stored once by their SHA-256, removed only when nothing refers to them
// (DATA-11).
export {
  collectAssets,
  getAsset,
  readAsset,
  referencedAssets,
  storeAsset,
  sweepAssets,
  type AssetStore,
  type StoreAssetRefusal,
  type StoreAssetResult,
} from "./assets.ts";
export { sniffImage, type Sniffed } from "./sniff.ts";
