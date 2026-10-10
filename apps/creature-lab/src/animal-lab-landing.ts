import {animalLabEntryUrl} from './animal-lab-entry.ts';

const destination=animalLabEntryUrl(location.href);
(document.getElementById('open-animal-lab') as HTMLAnchorElement).href=destination;
location.replace(destination);
