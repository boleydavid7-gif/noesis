export type Chapter = { title: string; html: string } // html is the inside of a <body>, as XHTML
export type Picture = { name: string; type: string; data: Uint8Array } // referenced as images/<name>
export type Draft = { title: string; author: string; chapters: Chapter[]; pictures: Picture[]; cover?: string }
