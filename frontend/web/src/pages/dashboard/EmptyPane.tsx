export function EmptyPane({ title, body }: { title: string; body: string }) {
    return (
        <div className="empty-pane">
            <p className="empty-pane__title">{title}</p>
            <p className="empty-pane__body">{body}</p>
        </div>
    )
}


