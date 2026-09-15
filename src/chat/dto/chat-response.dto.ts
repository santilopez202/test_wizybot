import { ApiProperty } from '@nestjs/swagger';

export class ChatResponseDto {
  @ApiProperty({
    description: "The chatbot's final natural-language response to the customer.",
    example: 'I found two phones that might interest you: iPhone 12 ($900) and iPhone 13 ($1099).',
  })
  response: string;

  constructor(response: string) {
    this.response = response;
  }
}
