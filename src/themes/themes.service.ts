import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { orgs, type User } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { readStyles } from '../unfurl/unfurl';
import { cleanTheme, normHex, readLook, themeFromBrand, themeProblems, TRENCH_COAT, type DiagramTheme } from './diagram-theme';
import type { DiagramLookDto, SuggestThemeDto, ThemeSuggestionDto } from './themes.dto';

/**
 * A workspace's look for diagrams: everyone in it sees it; its owners set it, from scratch, from brand colours or from
 * a website, and can go back to Trench Coat's. A look is only kept if text on every fill meets WCAG 2.2 AA.
 */
@Injectable()
export class ThemesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orgs: OrgsService,
  ) {}

  async get(user: User, orgId: string): Promise<DiagramLookDto> {
    await this.orgs.roleIn(user.id, orgId);
    const [row] = await this.db.select({ theme: orgs.diagramTheme }).from(orgs).where(eq(orgs.id, orgId));
    const theme = row?.theme && !themeProblems(row.theme).length ? (row.theme as unknown as DiagramTheme) : null;
    return { custom: !!theme, theme: cleanTheme(theme ?? TRENCH_COAT) };
  }

  async set(user: User, orgId: string, theme: DiagramTheme): Promise<DiagramLookDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const problems = themeProblems(theme);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    const clean = cleanTheme(theme);
    await this.db
      .update(orgs)
      .set({ diagramTheme: clean as unknown as Record<string, unknown> })
      .where(eq(orgs.id, orgId));
    return { custom: true, theme: clean };
  }

  async reset(user: User, orgId: string): Promise<void> {
    await this.orgs.require(user.id, orgId, 'owner');
    await this.db.update(orgs).set({ diagramTheme: null }).where(eq(orgs.id, orgId));
  }

  /** A look to start from, not saved: read off a website's styles, or built from brand colours. */
  async suggest(user: User, orgId: string, body: SuggestThemeDto): Promise<ThemeSuggestionDto> {
    await this.orgs.require(user.id, orgId, 'owner');
    const notes: string[] = [];
    if (body.url?.trim()) {
      let styles: Awaited<ReturnType<typeof readStyles>>;
      try {
        styles = await readStyles(body.url.trim());
      } catch (e) {
        throw new BadRequestException(`That site's look couldn't be read: ${e instanceof Error ? e.message : 'it did not answer'}.`);
      }
      const look = readLook(styles.css);
      const name = body.name?.trim() || new URL(styles.url).hostname.replace(/^www\./, '');
      const theme = themeFromBrand(look.brand, { name, font: look.font, radius: look.radius ?? undefined });
      notes.push(
        `Read from ${styles.url}: ${look.brand.length} brand colour${look.brand.length === 1 ? '' : 's'} (${look.brand.join(', ') || 'none'}).`,
        ...look.notes,
        'Every fill was checked, and moved where needed, so text on it meets WCAG 2.2 AA in light and dark.',
      );
      return { theme, notes };
    }
    const colours = (body.colours ?? []).map((c) => normHex(c)).filter((c): c is string => !!c);
    if (!colours.length) throw new BadRequestException('Give a website or at least one brand colour.');
    notes.push(`Built from ${colours.join(', ')}.`, 'Every fill was checked, and moved where needed, so text on it meets WCAG 2.2 AA in light and dark.');
    return { theme: themeFromBrand(colours, { name: body.name }), notes };
  }
}
