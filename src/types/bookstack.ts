/** BookStack API types. Sourced from lib/BookStackApiClient.js and bookstack/*. */

export interface BookStackBook {
  id: number;
  name: string;
  slug: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: { id: number; name: string };
}

export interface BookStackChapter {
  id: number;
  book_id: number;
  name: string;
  slug: string;
  description?: string;
  priority?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BookStackPage {
  id: number;
  book_id: number;
  chapter_id?: number;
  name: string;
  slug: string;
  content?: string;
  markdown?: string;
  html?: string;
  revision_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface BookStackShelf {
  id: number;
  name: string;
  slug: string;
  description?: string;
  books?: BookStackBook[];
}

export interface BookStackSearchResult {
  id: number;
  name: string;
  type: 'book' | 'chapter' | 'page';
  preview_html?: string;
  url?: string;
}

export interface BookStackExportMeta {
  bookId: number;
  bookSlug: string;
  exportedAt: string;
  pageCount: number;
}

export interface BookStackAttachment {
  id: number;
  name: string;
  url: string;
  uploaded_to: number;
  size: number;
}
