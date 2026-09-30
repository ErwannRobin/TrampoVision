import type { Dictionary } from '..';
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

// Every domain of the English source, translated: the type says when a key is missing.
export const fr: Dictionary = {
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
};
