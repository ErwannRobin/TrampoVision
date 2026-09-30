/**
 * What a jump is called: body positions, somersault directions, the names of skills and of the elements of the table, and the
 * words the difficulty is explained with. Names are built from lowercase pieces and start with a capital letter at the end.
 */
export const names = {
  'list.separator': ', ',

  // Body positions and directions, as labels (a sentence lowercases them)
  'pos.straight': 'Straight',
  'pos.tuck': 'Tuck',
  'pos.pike': 'Pike',
  'pos.straddle': 'Straddle',
  'pos.unknown': 'Unknown',
  'dir.front': 'Front',
  'dir.back': 'Back',

  // What a person can say a jump was (five classes and "cannot tell")
  'truth.back': 'Back',
  'truth.front': 'Front',
  'truth.unknown': 'Unknown',

  // What the classifier can call a jump
  'skill.straight-jump': 'Straight Jump',
  'skill.tuck-jump': 'Tuck Jump',
  'skill.pike-jump': 'Pike Jump',
  'skill.back': 'Back',
  'skill.front': 'Front',
  'skill.fig-element': 'Element',
  'skill.somersault-direction-unknown': 'Somersault (front or back undetermined)',
  'skill.unclassified': 'Unclassified',

  // The name of an element: "Back somersault, full twist (straight)"
  'name.somersault.1': '{direction} somersault',
  'name.somersault.2': '{direction} double somersault',
  'name.somersault.3': '{direction} triple somersault',
  'name.somersault.1.any': 'somersault',
  'name.somersault.2.any': 'double somersault',
  'name.somersault.3.any': 'triple somersault',
  'name.twist.half': '½ twist',
  'name.twist.full': 'full twist',
  'name.twist.many': { one: '{n} twist', other: '{n} twists' },
  'name.twist.manyHalf': { one: '{n}½ twist', other: '{n}½ twists' },
  'name.withTwist': '{name}, {twist}',
  'name.withPosition': '{name} ({position})',
  'name.jump.straight': 'straight jump',
  'name.jump.tuck': 'tuck jump',
  'name.jump.pike': 'pike jump',
  'name.jump.straddle': 'straddle jump',
  'name.jumpTwist': '{twist} jump',

  // The parts of a difficulty value
  'difficulty.jump': 'Jump',
  'difficulty.twists': 'Twists',
  'difficulty.somersaultsQuarters': 'Somersaults and quarters',
  'difficulty.somersaults': 'Somersaults',
  'difficulty.quarters': 'Quarter somersaults',
  'difficulty.twistingMultiple': 'Twisting multiple somersault',
  'difficulty.backwardMultiple': 'Backward multiple somersault',
  'difficulty.pike': 'Pike position',
  'difficulty.straight': 'Straight position',
} as const;
