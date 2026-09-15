import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message to the Wizybot AI chatbot and get its final response.' })
  @ApiResponse({ status: 201, description: 'The chatbot final response.', type: ChatResponseDto })
  async chat(@Body() chatRequestDto: ChatRequestDto): Promise<ChatResponseDto> {
    const response = await this.chatService.getResponse(chatRequestDto.message);
    return new ChatResponseDto(response);
  }
}
