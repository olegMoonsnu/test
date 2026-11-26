// Тело синхронного пользовательского действия «Аналитика» для объектов списка.
if (list == null) {
    result.showMessage('Аналитика', 'Откройте действие на панели списка объектов.')
    return
}
if (list.limitExceeded()) {
    result.showMessage('Аналитика', 'В таблице больше 1000 объектов. Сузьте фильтр и нажмите кнопку ещё раз.')
    return
}
int count = 0
list.each { count++ }
result.showMessage('Аналитика по таблице', 'Объектов в текущем списке: ' + count)
