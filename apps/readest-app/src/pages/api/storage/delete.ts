// 改造自原 src/pages/api/storage/delete.ts。
import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { prismaClient } from '@/utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) return res.status(403).json({ error: 'Not authenticated' });

    const { fileKey } = req.query;
    if (!fileKey || typeof fileKey !== 'string') return res.status(400).json({ error: 'Missing or invalid fileKey' });

    const fileRecord = await prismaClient.file.findFirst({
      where: { userId: user.id, fileKey, deletedAt: null },
    });
    if (!fileRecord) return res.status(404).json({ error: 'File not found' });
    if (fileRecord.userId !== user.id) return res.status(403).json({ error: 'Unauthorized access to the file' });

    try {
      await deleteObject(fileKey);
      await prismaClient.file.delete({ where: { id: fileRecord.id } });
      return res.status(200).json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Error deleting file:', error);
      return res.status(500).json({ error: 'Could not delete file from storage' });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
