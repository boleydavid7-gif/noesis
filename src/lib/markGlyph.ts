// Noesis's icon glyph on the 1024 canvas: a copy of GLYPH in scripts/icons/build.mjs (a test keeps the two the same).
// 'light' is the cream, 'gold' its shade (the lower pages), 'stem' a stroke, 'vein' a cut through a leaf.
export const MARK_GLYPH: [string, 'gold' | 'light' | 'stem' | 'vein'][] = [
  [
    'M151 667 C300 662 452 712 507 812 L512 834 L517 812 C572 712 724 662 873 667 L925 748 C764 745 604 770 518 838 L512 852 L506 838 C420 770 260 745 99 748 Z',
    'gold',
  ],
  ['M231 549 C340 548 458 594 507 790 C430 690 310 640 162 643 Z', 'light'],
  ['M793 549 C684 548 566 594 517 790 C594 690 714 640 862 643 Z', 'light'],
  ['M512 806 C508 700 510 624 518 566', 'stem'],
  ['M528 566 C468 420 566 252 800 196 C792 372 702 512 528 566 Z', 'light'],
  ['M505 568 C428 562 298 500 256 360 C380 356 492 430 505 568 Z', 'light'],
  ['M552 536 C600 448 662 360 744 282', 'vein'],
  ['M486 542 C436 498 368 438 300 392', 'vein'],
]
