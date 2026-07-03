import { getRuntimeConfig } from '@/services/runtimeConfig';

// Readest Lite — 加 'local' 类型，默认 'local'（原项目默认 'r2'）。
// v8.12.0 上游同步时不慎覆盖了 Lite 自定义，导致 getRemoteBookFilename 在 'local' 分支
// 返回空串 → fileKey 形如 "<uid>/Readest/Books/" → 下载报 "File not found"。
// 此处恢复 Lite 自定义行为，'local' 与 'r2' 在文件名规则上等价。
type ObjectStorageType = 'r2' | 's3' | 'local';

export const getStorageType = (): ObjectStorageType => {
  const runtimeType = getRuntimeConfig()?.objectStorageType ?? process.env['OBJECT_STORAGE_TYPE'];
  return (runtimeType as ObjectStorageType) || 'local';
};
