import { fetchWithPool } from './http';
import { recordApiLatency } from './HealthService.js';

interface BookStackConfig {
  url: string;
  tokenId: string;
  tokenSecret: string;
}

export interface BookStackBook {
  id: number;
  slug: string;
  name: string;
  description?: string;
  updated_at?: string;
}

export interface BookStackChapter {
  id: number;
  slug: string;
  name: string;
  description?: string;
  book_id?: number;
}

export interface BookStackPage {
  id: number;
  slug: string;
  name: string;
  chapter_id?: number | null;
  book_id?: number;
  updated_at?: string;
  revision_count?: number;
  markdown?: string;
}

interface BookStackPageList {
  data: BookStackPage[];
}

interface BookContents {
  chapters: { data: BookStackChapter[] };
  pages: { data: BookStackPage[] };
}

interface PageFilters {
  updatedAfter?: string;
  count?: number;
}

interface SearchOptions {
  count?: number;
  type?: string;
}

export class BookStackApiClient {
  private baseUrl: string;
  private tokenId: string;
  private tokenSecret: string;

  constructor(config: BookStackConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.tokenId = config.tokenId;
    this.tokenSecret = config.tokenSecret;
  }

  async request(
    endpoint: string,
    options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<unknown> {
    const url = `${this.baseUrl}/api/${endpoint}`;
    const startTime = Date.now();

    const fetchOptions: Record<string, unknown> = {
      method: options.method || 'GET',
      headers: {
        Authorization: `Token ${this.tokenId}:${this.tokenSecret}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    if (options.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetchWithPool(url, fetchOptions);

    const duration = Date.now() - startTime;
    recordApiLatency('bookstack', endpoint.split('/')[0]!, duration);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BookStack API ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  async listBooks(): Promise<BookStackBook[]> {
    const result = (await this.request('books?count=500')) as BookStackPageList;
    return (result.data || []) as BookStackBook[];
  }

  async getBook(idOrSlug: string | number): Promise<BookStackBook> {
    return this.request(`books/${idOrSlug}`) as Promise<BookStackBook>;
  }

  async getBookContents(bookId: number): Promise<BookContents> {
    const [chapters, pages] = await Promise.all([
      this.request(`chapters?filter[book_id]=${bookId}&count=500`) as Promise<BookStackPageList>,
      this.request(`pages?filter[book_id]=${bookId}&count=500`) as Promise<BookStackPageList>,
    ]);

    return {
      chapters: { data: (chapters.data || []) as BookStackChapter[] },
      pages: { data: (pages.data || []) as BookStackPage[] },
    };
  }

  async exportBookMarkdown(idOrSlug: string | number): Promise<unknown> {
    return this.request(`books/${idOrSlug}/export/markdown`);
  }

  async exportPageMarkdown(pageId: number): Promise<unknown> {
    return this.request(`pages/${pageId}/export/markdown`);
  }

  async exportChapterMarkdown(chapterId: number): Promise<unknown> {
    return this.request(`chapters/${chapterId}/export/markdown`);
  }

  async getPage(pageId: number): Promise<BookStackPage> {
    return this.request(`pages/${pageId}`) as Promise<BookStackPage>;
  }

  async listPagesByBook(bookId: number, filters: PageFilters = {}): Promise<BookStackPage[]> {
    const params = new URLSearchParams();
    params.set('filter[book_id]', String(bookId));
    if (filters.updatedAfter) {
      params.set('filter[updated_at:gte]', filters.updatedAfter);
    }
    params.set('count', String(filters.count || 500));
    const result = (await this.request(`pages?${params}`)) as BookStackPageList;
    return (result.data || []) as BookStackPage[];
  }

  async search(query: string, options: SearchOptions = {}): Promise<unknown> {
    const params = new URLSearchParams({ query, count: String(options.count || 20) });
    if (options.type) params.set('type', options.type);
    return this.request(`search?${params}`);
  }

  async createPage(data: { book_id?: number; chapter_id?: number; name: string; markdown: string }): Promise<BookStackPage> {
    return this.request('pages', { method: 'POST', body: data }) as Promise<BookStackPage>;
  }

  async updatePage(pageId: number, data: { name?: string; markdown?: string }): Promise<BookStackPage> {
    return this.request(`pages/${pageId}`, { method: 'PUT', body: data }) as Promise<BookStackPage>;
  }

  async createChapter(data: { book_id: number; name: string; description?: string }): Promise<BookStackChapter> {
    return this.request('chapters', { method: 'POST', body: data }) as Promise<BookStackChapter>;
  }

  async updateChapter(chapterId: number, data: { name?: string; description?: string }): Promise<BookStackChapter> {
    return this.request(`chapters/${chapterId}`, { method: 'PUT', body: data }) as Promise<BookStackChapter>;
  }

  async testConnection(): Promise<{ connected: boolean; bookCount: number; error?: string }> {
    try {
      const books = await this.listBooks();
      return { connected: true, bookCount: books.length };
    } catch (error) {
      return { connected: false, bookCount: 0, error: (error as Error).message };
    }
  }
}

export function createBookStackApiClient(config: BookStackConfig): BookStackApiClient {
  return new BookStackApiClient(config);
}
