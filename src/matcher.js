// Scores how close videos are to the user's topics by comparing their text embeddings.
// Pure logic: the embedding model is passed in, so this runs anywhere.
(() => {
  "use strict";

  const DEFAULT_CACHE_SIZE = 2000; // Video vectors kept between requests, enough for a long viewing session.
  const DEFAULT_BATCH_SIZE = 32; // Texts per model call, which bounds the memory of one inference.

  // The vectors are L2-normalized, so their dot product is their cosine similarity.
  function dot(a, b) {
    let sum = 0;
    for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
    return sum;
  }

  function videoText({ title, channel }) {
    return channel ? `${title} | ${channel}` : title;
  }

  function chunk(items, size) {
    const chunks = [];
    for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
    return chunks;
  }

  // A Map that forgets its least recently used entries beyond capacity.
  function createLruCache(capacity) {
    const entries = new Map();
    return {
      get(key) {
        if (!entries.has(key)) return undefined;
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        entries.delete(key);
        entries.set(key, value);
        if (entries.size > capacity) entries.delete(entries.keys().next().value);
      },
    };
  }

  function createMatcher({
    embed,
    cacheSize = DEFAULT_CACHE_SIZE,
    batchSize = DEFAULT_BATCH_SIZE,
  }) {
    const videoVectors = createLruCache(cacheSize);
    let topicVectors = { key: null, vectors: [] };

    // Returns a Map from each distinct text to its vector, embedding batchSize texts at a time.
    async function embedAll(texts) {
      const vectors = new Map();
      for (const batch of chunk([...new Set(texts)], batchSize)) {
        const embedded = await embed(batch);
        batch.forEach((text, index) => vectors.set(text, embedded[index]));
      }
      return vectors;
    }

    // Topics rarely change between requests, so their vectors are kept for the latest list.
    async function vectorsForTopics(topics) {
      const key = JSON.stringify(topics);
      if (topicVectors.key !== key) {
        const vectors = await embedAll(topics);
        topicVectors = { key, vectors: topics.map((topic) => vectors.get(topic)) };
      }
      return topicVectors.vectors;
    }

    // Collects the vectors locally so a request larger than the cache still has all of them.
    async function vectorsForTexts(texts) {
      const vectors = new Map();
      for (const text of texts) {
        const cached = videoVectors.get(text);
        if (cached) vectors.set(text, cached);
      }
      const fresh = await embedAll(texts.filter((text) => !vectors.has(text)));
      for (const [text, vector] of fresh) {
        videoVectors.set(text, vector);
        vectors.set(text, vector);
      }
      return vectors;
    }

    // Resolves to { [id]: score }, the video's highest similarity to any topic, from -1 to 1.
    // Without topics, every video counts as a perfect match.
    async function score(topics, videos) {
      if (topics.length === 0) return Object.fromEntries(videos.map(({ id }) => [id, 1]));
      const topicList = await vectorsForTopics(topics);
      const texts = videos.map((video) => videoText(video));
      const vectors = await vectorsForTexts(texts);
      return Object.fromEntries(videos.map(({ id }, index) => {
        const vector = vectors.get(texts[index]);
        return [id, Math.max(...topicList.map((topic) => dot(topic, vector)))];
      }));
    }

    return Object.freeze({ score });
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.matcher = Object.freeze({ createMatcher });
})();
