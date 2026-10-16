import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { parsePageQuery, type Page } from '../../common/pagination.js';
import type { VideoSummary } from '../videos/video.model.js';
import type { Group } from './group.model.js';
import {
  GroupNotFoundError,
  GroupsService,
  UnknownVideosError,
} from './groups.service.js';

type Body = Record<string, unknown> | undefined;

const MAX_NAME_LENGTH = 200;

/**
 * Named sets of videos. Unknown group ids are 404; unknown video ids are 400
 * with the ids in the message, and nothing is changed.
 */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  /** Body: `{ name, videoIds? }`. */
  @Post()
  create(@Body() body: Body): Promise<Group> {
    const name = parseName(body?.name);
    const videoIds =
      body?.videoIds === undefined ? undefined : parseVideoIds(body.videoIds);
    return handle(() => this.groups.create({ name, videoIds }));
  }

  /** `?page=&pageSize=`. Newest first. */
  @Get()
  findMany(@Query() query: Record<string, unknown>): Promise<Page<Group>> {
    return this.groups.findMany(parsePageQuery(query));
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Group> {
    const group = await this.groups.findOne(id);
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return group;
  }

  /** Body: `{ name?, videoIds? }`. `videoIds` replaces the group's videos. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Body): Promise<Group> {
    const data: { name?: string; videoIds?: string[] } = {};
    if (body?.name !== undefined) data.name = parseName(body.name);
    if (body?.videoIds !== undefined) {
      data.videoIds = parseVideoIds(body.videoIds);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Give name and/or videoIds');
    }
    return handle(() => this.groups.update(id, data));
  }

  /** Deletes the group. Its videos are not deleted. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return handle(() => this.groups.remove(id));
  }

  /** `?page=&pageSize=`. In the order they were added, without `metadata`. */
  @Get(':id/videos')
  videos(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Page<VideoSummary>> {
    const request = parsePageQuery(query);
    return handle(() => this.groups.videos(id, request));
  }

  /** Body: `{ videoIds }`. Videos already in the group are skipped. */
  @Post(':id/videos')
  @HttpCode(200)
  addVideos(@Param('id') id: string, @Body() body: Body): Promise<Group> {
    const videoIds = parseVideoIds(body?.videoIds);
    return handle(() => this.groups.addVideos(id, videoIds));
  }

  @Delete(':id/videos/:videoId')
  @HttpCode(204)
  async removeVideo(
    @Param('id') id: string,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    const removed = await handle(() => this.groups.removeVideo(id, videoId));
    if (!removed) {
      throw new NotFoundException(`Video ${videoId} is not in group ${id}`);
    }
  }
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`,
    );
  }
  return name;
}

function parseVideoIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((v) => typeof v === 'string' && v !== '')
  ) {
    throw new BadRequestException('videoIds must be an array of video ids');
  }
  return value;
}

async function handle<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GroupNotFoundError) {
      throw new NotFoundException(err.message);
    }
    if (err instanceof UnknownVideosError) {
      throw new BadRequestException(err.message);
    }
    throw err;
  }
}
