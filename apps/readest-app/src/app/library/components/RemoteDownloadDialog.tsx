'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { downloadBookFromUrl } from '@/services/remoteDownload';
import { eventDispatcher } from '@/utils/event';

interface RemoteDownloadDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function RemoteDownloadDialog({ open, onClose }: RemoteDownloadDialogProps) {
  const _ = useTranslation();
  const { user } = useAuth();
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = useCallback(async () => {
    if (!url.trim() || !user) return;
    setDownloading(true);
    setError('');
    try {
      const result = await downloadBookFromUrl(url.trim(), filename.trim() || undefined);
      eventDispatcher.dispatch('toast', {
        message: _('Downloaded: {{filename}}', { filename: result.filename }),
        type: 'success',
        timeout: 3000,
      });
      setUrl('');
      setFilename('');
      onClose();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Download failed'));
    } finally {
      setDownloading(false);
    }
  }, [url, filename, user, _, onClose]);

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md mx-4'>
        <h2 className='text-lg font-bold mb-4'>{_('Download Book from URL')}</h2>
        <p className='text-base-content/60 text-sm mb-4'>
          {_('Enter a direct URL to an EPUB/PDF/MOBI file. The server will download and add it to your library.')}
        </p>
        <div className='space-y-3'>
          <div>
            <label className='text-sm font-medium mb-1 block'>{_('URL')}</label>
            <input
              type='url'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder='https://example.com/book.epub'
              className='input input-bordered w-full'
              disabled={downloading}
              autoFocus
            />
          </div>
          <div>
            <label className='text-sm font-medium mb-1 block'>{_('Filename (optional)')}</label>
            <input
              type='text'
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder='book.epub'
              className='input input-bordered w-full'
              disabled={downloading}
            />
          </div>
          {error && <div className='text-sm text-red-500'>{error}</div>}
        </div>
        <div className='flex gap-2 mt-6'>
          <button onClick={handleDownload} disabled={downloading || !url.trim()} className='btn btn-primary flex-1'>
            {downloading ? <span className='loading loading-spinner loading-sm' /> : _('Download')}
          </button>
          <button onClick={onClose} className='btn btn-ghost' disabled={downloading}>{_('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}
