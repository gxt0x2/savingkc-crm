/**
 * Area-code time zones for recipient-local SMS hours.
 *
 * Groupings follow the North American area-code zones published with
 * phone-number-to-timezone (MIT). A code assigned to one zone uses that
 * zone. A code the source splits across zones is ported/ambiguous.
 * Codes missing from the map, including toll-free, are unknown.
 */

export type AreaCodeTimeZone =
  | { kind: 'known'; timeZone: string }
  | { kind: 'ported'; timeZones: readonly string[] }
  | { kind: 'unknown' }

const KNOWN_ZONES: Record<string, string> = {}

function assignZone(timeZone: string, codes: string): void {
  for (const code of codes.split(/\s+/)) {
    if (code) KNOWN_ZONES[code] = timeZone
  }
}

assignZone('America/Anchorage', [
  '907',
].join(' '))

assignZone('America/Chicago', [
  '204 205 210 214 217 218 224 225 228 251 254 256 262 274 281 309 312 314 316 318 319 320',
  '325 327 331 334 337 346 361 402 405 409 414 417 430 431 432 447 464 469 474 479 501 504',
  '507 512 515 531 534 539 557 563 572 573 580 584 601 608 612 615 618 625 629 630 636 641',
  '651 659 660 662 682 708 712 713 715 726 731 737 763 769 773 779 806 815 816 817 830 832',
  '847 861 870 872 901 903 913 918 920 936 938 940 945 952 956 972 975 979 985',
].join(' '))

assignZone('America/Denver', [
  '303 307 368 385 403 406 435 505 575 587 719 720 780 801 825 970 983',
].join(' '))

assignZone('America/Halifax', [
  '441 506 782 902',
].join(' '))

assignZone('America/Honolulu', [
  '808',
].join(' '))

assignZone('America/Los_Angeles', [
  '206 209 213 236 250 253 279 310 323 341 350 360 408 415 424 425 442 503 509 510 530 559',
  '562 564 604 619 626 628 650 657 661 669 672 702 707 714 725 747 760 775 778 805 818 820',
  '831 840 858 909 916 925 949 951 971',
].join(' '))

assignZone('America/New_York', [
  '201 202 203 207 212 215 216 220 223 226 229 231 234 239 240 242 248 249 252 260 263 267',
  '269 272 276 283 289 301 302 304 305 313 315 317 321 326 329 330 332 336 339 343 347 351',
  '352 354 363 365 367 380 382 386 401 404 407 410 412 413 416 418 419 428 434 437 438 440',
  '443 445 450 463 468 470 472 475 478 484 502 508 513 514 516 517 518 519 540 548 551 561',
  '567 570 571 579 581 582 585 586 603 607 609 610 613 614 616 617 631 640 645 646 647 649',
  '656 658 667 678 680 681 683 689 703 704 705 706 716 717 718 724 727 728 732 734 740 742',
  '743 753 754 757 762 765 770 771 772 774 781 786 802 803 804 809 810 813 814 819 826 828',
  '829 835 838 839 843 845 848 849 854 856 857 859 860 862 863 864 865 873 876 878 904 905',
  '908 910 912 914 917 919 929 930 934 937 941 943 947 948 954 959 973 978 980 984 989',
].join(' '))

assignZone('America/Phoenix', [
  '480 520 602 623 928',
].join(' '))

assignZone('America/Puerto_Rico', [
  '246 264 268 284 340 345 473 664 721 758 767 784 787 868 869 939',
].join(' '))

assignZone('America/Regina', [
  '306 639',
].join(' '))

assignZone('America/St_Johns', [
  '709',
].join(' '))

assignZone('Pacific/Guam', [
  '670 671',
].join(' '))

assignZone('Pacific/Pago_Pago', [
  '684',
].join(' '))

const PORTED_ZONES: Record<string, readonly string[]> = {
  '208': ['America/Denver', 'America/Los_Angeles'],
  '219': ['America/Chicago', 'America/New_York'],
  '270': ['America/Chicago', 'America/New_York'],
  '308': ['America/Chicago', 'America/Denver'],
  '364': ['America/Chicago', 'America/New_York'],
  '423': ['America/Chicago', 'America/New_York'],
  '448': ['America/Chicago', 'America/New_York'],
  '458': ['America/Denver', 'America/Los_Angeles'],
  '541': ['America/Denver', 'America/Los_Angeles'],
  '574': ['America/Chicago', 'America/New_York'],
  '605': ['America/Chicago', 'America/Denver'],
  '606': ['America/Chicago', 'America/New_York'],
  '620': ['America/Chicago', 'America/Denver'],
  '701': ['America/Chicago', 'America/Denver'],
  '785': ['America/Chicago', 'America/Denver'],
  '807': ['America/Chicago', 'America/New_York'],
  '812': ['America/Chicago', 'America/New_York'],
  '850': ['America/Chicago', 'America/New_York'],
  '867': ['America/Chicago', 'America/Denver'],
  '906': ['America/Chicago', 'America/New_York'],
  '915': ['America/Chicago', 'America/Denver'],
  '931': ['America/Chicago', 'America/New_York'],
  '986': ['America/Denver', 'America/Los_Angeles'],
}

export function areaCodeTimeZone(areaCode: string | null | undefined): AreaCodeTimeZone {
  const code = String(areaCode ?? '').replace(/\D/g, '')
  const ported = PORTED_ZONES[code]
  if (ported) return { kind: 'ported', timeZones: ported }
  const timeZone = KNOWN_ZONES[code]
  if (!timeZone) return { kind: 'unknown' }
  return { kind: 'known', timeZone }
}
