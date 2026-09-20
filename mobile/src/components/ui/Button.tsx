import { Button as PaperButton, type ButtonProps as PaperButtonProps } from 'react-native-paper';

export type ButtonProps = PaperButtonProps;

export function Button(props: ButtonProps) {
  return <PaperButton mode="contained" {...props} />;
}
