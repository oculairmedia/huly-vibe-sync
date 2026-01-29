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

  // ============================================================
  // WRITE OPERATIONS (Phase 2 — Import/Push)
  // ============================================================

  /**
   * Create a new page in BookStack
   * @param {Object} data - Page data
   * @param {number} data.book_id - Book ID (required if no chapter_id)
   * @param {number} [data.chapter_id] - Chapter ID (optional, overrides book_id placement)
   * @param {string} data.name - Page title
   * @param {string} data.markdown - Markdown content
   * @returns {Promise<Object>} Created page object
   */
  async createPage(data) {
    return this.request('pages', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Update an existing page in BookStack
   * @param {number} pageId - Page ID
   * @param {Object} data - Updated page data
   * @param {string} [data.name] - Page title
   * @param {string} [data.markdown] - Markdown content
   * @returns {Promise<Object>} Updated page object
   */
  async updatePage(pageId, data) {
    return this.request(`pages/${pageId}`, {
      method: 'PUT',
      body: data,
    });
  }

  /**
   * Create a new chapter in BookStack
   * @param {Object} data - Chapter data
   * @param {number} data.book_id - Book ID
   * @param {string} data.name - Chapter title
   * @param {string} [data.description] - Chapter description
   * @returns {Promise<Object>} Created chapter object
   */
  async createChapter(data) {
    return this.request('chapters', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Update an existing chapter in BookStack
   * @param {number} chapterId - Chapter ID
   * @param {Object} data - Updated chapter data
   * @param {string} [data.name] - Chapter title
   * @param {string} [data.description] - Chapter description
   * @returns {Promise<Object>} Updated chapter object
   */
  async updateChapter(chapterId, data) {
    return this.request(`chapters/${chapterId}`, {
      method: 'PUT',
      body: data,
    });
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
