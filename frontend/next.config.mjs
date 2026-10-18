/** Static export: plain files that Firebase Hosting serves. There is no server and no API. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // app/global-not-found.tsx becomes out/404.html, the page Firebase Hosting serves for unknown
  // addresses. The app has two root layouts, so an ordinary not-found page cannot cover them all.
  experimental: { globalNotFound: true },
};

export default nextConfig;
