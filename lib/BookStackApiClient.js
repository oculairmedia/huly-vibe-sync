import { fetchWithPool } from './http.js';
import { logger } from './logger.js';
import { recordApiLatency } from './HealthService.js';

export class BookStackApiClient {
  constructor(config) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.tokenId = config.tokenId;
    this.tokenSecret = config.tokenSecret;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api/${endpoint}`;
    const startTime = Date.now();

    const response = await fetchWithPool(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Token ${this.tokenId}:${this.tokenSecret}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const duration = Date.now() - startTime;
    recordApiLatency('bookstack', endpoint.split('/')[0], duration);

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

  async listBooks() {
    const result = await this.request('books?count=500');
    return result.data || [];
  }

  async getBook(idOrSlug) {
    return this.request(`books/${idOrSlug}`);
  }

  async getBookContents(bookId) {
    const [chapters, pages] = await Promise.all([
      this.request(`chapters?filter[book_id]=${bookId}&count=500`),
      this.request(`pages?filter[book_id]=${bookId}&count=500`),
    ]);

    return {
      chapters: chapters.data || [],
      pages: pages.data || [],
    };
  }

  async exportBookMarkdown(idOrSlug) {
    return this.request(`books/${idOrSlug}/export/markdown`);
  }

  async exportPageMarkdown(pageId) {
    return this.request(`pages/${pageId}/export/markdown`);
  }

  async exportChapterMarkdown(chapterId) {
    return this.request(`chapters/${chapterId}/export/markdown`);
  }

  async getPage(pageId) {
    return this.request(`pages/${pageId}`);
  }

  async search(query, options = {}) {
    const params = new URLSearchParams({ query, count: options.count || 20 });
    if (options.type) params.set('type', options.type);
    return this.request(`search?${params}`);
  }

  async testConnection() {
    try {
      const books = await this.listBooks();
      return { connected: true, bookCount: books.length };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }
}

export function createBookStackApiClient(config) {
  return new BookStackApiClient(config);
}
