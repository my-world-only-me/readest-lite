import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();
  const { appService } = useEnv();

  // v8.1.0：法务链接指向 Readest Lite 部署教程站
  const termsUrl =
    appService?.isIOSApp || appService?.isMacOSApp
      ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
      : 'https://cshdotcom.github.io/readestl/';

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      <Link href={termsUrl} className='text-blue-500 underline hover:text-blue-600'>
        {_('Terms of Service')}
      </Link>
      <Link
        href='https://cshdotcom.github.io/readestl/'
        className='text-blue-500 underline hover:text-blue-600'
      >
        {_('Privacy Policy')}
      </Link>
    </div>
  );
};

export default LegalLinks;
