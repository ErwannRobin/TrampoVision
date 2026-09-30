import { chrome } from './chrome';
import { classifier } from './classifier';
import { coach } from './coach';
import { coaching } from './coaching';
import { errors } from './errors';
import { insights } from './insights';
import { names } from './names';
import { review } from './review';
import { reviewer } from './reviewer';
import { twist } from './twist';
import { viewer } from './viewer';

/** Every message of the interface, in English: the source the other languages are written from. */
export const en = {
  ...chrome,
  ...names,
  ...classifier,
  ...coaching,
  ...insights,
  ...coach,
  ...twist,
  ...viewer,
  ...review,
  ...errors,
  ...reviewer,
} as const;
