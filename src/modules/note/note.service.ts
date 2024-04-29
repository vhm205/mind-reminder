import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RedisCache } from '@tirke/node-cache-manager-ioredis';

import { Channel, Note } from '@schema';
import { PageDto, PageMetaDto, ResponseType } from '@common';
import {
  CreateNoteDto,
  CreateNoteResponseDto,
  DeleteNoteResponseDto,
  GetNoteResponseDto,
  GetNotesQueryDto,
  UpdateNoteDto,
  UpdateNoteResponseDto,
} from './dtos';

@Injectable()
export class NoteService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<Note>,
    @InjectModel(Channel.name) private channelModel: Model<Channel>,
    @Inject(CACHE_MANAGER) private redisCache: RedisCache,
  ) {}

  getRedisKey(params: string): string {
    return `note:${params}`;
  }

  async createNote(
    payload: CreateNoteDto,
    userId: string,
  ): Promise<ResponseType<CreateNoteResponseDto>> {
    try {
      let { channelId, content, tags } = payload;

      if (!payload.channelId) {
        const channel = await this.channelModel.findOne({
          isDefault: true,
          user: userId,
          deletedAt: null,
        });

        if (!channel) {
          throw new HttpException(
            'You need to connect to at least one channel',
            HttpStatus.NOT_FOUND,
          );
        }

        channelId = channel.id;
      }

      const newNote = await this.noteModel.create({
        content,
        tags,
        channel: channelId,
        user: userId,
      });
      return { data: { id: newNote.id }, statusCode: HttpStatus.CREATED };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getNote(
    id: string,
    userId: string,
  ): Promise<ResponseType<GetNoteResponseDto>> {
    try {
      const note = await this.noteModel
        .findOne({ _id: id, user: userId })
        .select('-_id id content tags channel status')
        .populate({
          path: 'channel',
          select: 'name type',
        })
        .lean();

      if (!note) {
        throw new HttpException('Note Not Found', HttpStatus.NOT_FOUND);
      }

      return {
        data: {
          id: note.id,
          content: note.content,
          tags: note.tags,
          channel: note.channel as Channel,
        },
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getNotes(
    query: GetNotesQueryDto,
    userId: string,
  ): Promise<ResponseType<PageDto<GetNoteResponseDto>>> {
    try {
      const notes = await this.noteModel
        .find({ user: userId })
        .select('-_id id content tags status')
        .skip(query.skip)
        .limit(query.limit)
        .lean();

      const totalRecord = await this.noteModel.countDocuments({ userId });

      const pageMeta = new PageMetaDto({
        totalRecord,
        pageOptionsDto: query,
      });
      const pageData = new PageDto<Omit<GetNoteResponseDto, 'channel'>>(
        notes,
        pageMeta,
      );

      return {
        data: pageData,
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateNote(
    id: string,
    userId: string,
    payload: UpdateNoteDto,
  ): Promise<ResponseType<UpdateNoteResponseDto>> {
    try {
      const result = await this.noteModel.updateOne(
        { _id: id, user: userId },
        {
          $set: payload,
        },
      );

      return {
        data: {
          id,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
        },
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteNote(
    id: string,
    userId: string,
  ): Promise<ResponseType<DeleteNoteResponseDto>> {
    try {
      const note = await this.noteModel.findOne({ _id: id, user: userId });

      if (!note) {
        throw new HttpException('Note Not Found', HttpStatus.NOT_FOUND);
      }

      const [result] = await Promise.all([
        this.noteModel.deleteOne({ _id: id, user: userId }),
        this.channelModel.deleteOne({ _id: note.channel }),
      ]);

      return {
        statusCode: HttpStatus.NO_CONTENT,
        data: {
          id,
          deletedCount: result.deletedCount,
        },
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
