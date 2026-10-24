import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { sectorKeys, beneficiariesKeys } from './data/taxonomy';

const nonprofits = defineCollection({
  // One Markdown file per nonprofit. The file name becomes the URL:
  // src/content/nonprofits/coastal-care-trust.md -> /nonprofits/coastal-care-trust/
  loader: glob({ pattern: '**/*.md', base: './src/content/nonprofits' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      // Optional. Path relative to the .md file, e.g. ../../assets/logos/my-charity.svg
      // Leave it out and a placeholder logo is shown instead.
      logo: image().optional(),
      logoAlt: z.string().optional(),
      sectors: z.array(z.enum(sectorKeys)).min(1),
      beneficiaries: z.array(z.enum(beneficiariesKeys)).default([]),
      // Shown on the card, clamped to three lines. Keep it short.
      blurb: z.string().max(240),
      location: z.string().optional(),
      website: z.url().optional(),
      donateUrl: z.url().optional(),
      volunteerUrl: z.url().optional(),
      email: z.email().optional(),
      phone: z.string().optional(),
      // NZ Charities Register number, e.g. CC12345
      charitiesNumber: z
        .string()
        .regex(/^CC\d{5,6}$/, 'Charities number should look like CC12345')
        .optional(),
      // Set to true to hide a listing without deleting the file.
      draft: z.boolean().default(false),
    }),
});

const resources = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: ({ image }) => z.object({
    article_title: z.string(),
    article_author: z.string(),
    article_readtime: z.string(),
    article_hero_image: image(),
    article_hero_image_alt: z.string(),
  }),
});

export const collections = { nonprofits, resources };
