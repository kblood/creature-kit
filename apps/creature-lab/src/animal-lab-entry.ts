/** One primary app entry. Existing recipe, eye, comparison, herd and playback
 * parameters are forwarded verbatim; another explicit mode still gets the
 * existing composer's visible rejection instead of being reinterpreted. */
export function animalLabEntryUrl(href:string):string {
  const source=new URL(href),target=new URL('./creature-lab.html',source);
  target.search=source.search;
  if(!source.searchParams.has('mode'))target.search=`${source.search}${source.search?'&':'?'}mode=composer`;
  target.hash=source.hash;
  return target.href;
}
