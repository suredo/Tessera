// Docs: docs/code/server/assets.md
// The asset store: images stored once by their SHA-256, removed only when nothing refers to them
// (DATA-11).
export {
  assetsNamedIn,
  collectAssets,
  getAsset,
  holdingAssets,
  readAsset,
  readAssetNow,
  referencedAssets,
  storeAsset,
  sweepAssets,
  workspaceAssets,
  type AssetStore,
  type StoreAssetRefusal,
  type StoreAssetResult,
} from "./assets.ts";
export { sniffImage, type Sniffed } from "./sniff.ts";
