/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  api: {
    bodyParser: false, // required for formidable (file upload)
  },
};

module.exports = nextConfig;
