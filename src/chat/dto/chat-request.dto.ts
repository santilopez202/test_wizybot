import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({
    description: "The customer's message to the chatbot.",
    example: 'I am looking for a phone',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;
}
