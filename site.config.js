
export default {
  name: "pkg.link",
  locales: ['en'],

  static: true,

  jsxFactory: 'm',
  jsxFragment: '"["',

  // Not applied in production (up to static CDN host to do this)
  rewrites: {
    '/npm/*': 'file:client/index.html'
  }
}
