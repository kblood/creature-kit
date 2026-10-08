export const browserArgs=process.env.ATLAS_HARDWARE
  ? (process.platform==='win32'?['--use-angle=d3d11','--enable-gpu']:['--enable-gpu'])
  : ['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
