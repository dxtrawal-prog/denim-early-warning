import serwistInit from '@serwist/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

const withSerwist = serwistInit({
  swSrc: 'src/sw.js',
  swDest: 'public/sw.js',
});

export default withSerwist(nextConfig);
