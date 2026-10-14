/** @type {import('next').NextConfig} */
const nextConfig = {
  // Institution logos are plain <img> tags rather than next/image, so no
  // remote-pattern allowlist is needed. Keeping it that way avoids a
  // config change every time a source adds a new CDN host.
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
