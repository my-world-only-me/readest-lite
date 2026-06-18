// 改造后的 utils/object.ts。
// 原本根据 OBJECT_STORAGE_TYPE 选 r2/s3，现统一指向本地文件系统。
// 对外 API 与原版完全一致，所有调用方零改动。
export { isSafeObjectKeyName } from './localStorage';
export {
  getUploadSignedUrl,
  getDownloadSignedUrl,
  putObject,
  deleteObject,
  objectExists,
  copyObject,
  verifyPutSig,
  verifyGetSig,
  openReadStream,
  getFileSize,
  createWriteStreamForKey,
} from './localStorage';
