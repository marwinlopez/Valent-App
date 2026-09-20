import { Card as PaperCard } from 'react-native-paper';
import type { ComponentProps } from 'react';

export type CardProps = ComponentProps<typeof PaperCard>;

export function Card(props: CardProps) {
  return <PaperCard {...props} />;
}
